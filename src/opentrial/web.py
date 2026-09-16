"""Small, local-only HTTP adapter for the JavaScript workspace.

The statistical workflow is shared with Streamlit. No calculations are duplicated
in JavaScript and no API keys are sent to the browser.
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from opentrial.integrations.registry import integration_statuses
from opentrial.schemas import TrialDesignInput
from opentrial.workflow import CORE_EVIDENCE_SOURCES, EXTRA_EVIDENCE_SOURCES, EVIDENCE_SOURCES, SRC_DEMO, run_design

STATIC_ROOT = Path(__file__).resolve().parent / "static"
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/appearance.js": ("appearance.js", "text/javascript; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/chart.js": ("chart.js", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
MAX_BODY = 32_768
_RUN_SLOT = BoundedSemaphore(1)
logger = logging.getLogger(__name__)


class WorkspaceDesign(TrialDesignInput):
    """Bound interactive workloads to the same limits as the original form."""

    indication: str = Field(min_length=1, max_length=300)
    endpoint: str = Field(min_length=1, max_length=300)
    target_effect: float = Field(gt=0, le=2)
    alpha: float = Field(ge=0.001, le=0.20)
    desired_power: float = Field(ge=0.50, le=0.99)
    max_n_per_arm: int = Field(ge=40, le=1000)
    endpoint_sd: float = Field(default=1.0, ge=0.1, le=20)
    baseline_proportion: float = Field(default=0.30, ge=0.01, le=0.99)
    dropout_rate: float = Field(default=0.0, ge=0, le=0.90)


class AnalysisOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    use_bayesian_prior: bool = False
    use_gemini_narrative: bool = False
    use_mc_operating_characteristics: bool = False
    use_prior_sensitivity: bool = False
    use_group_sequential: bool = False
    gs_n_looks: int = Field(default=4, ge=2, le=6)
    gs_boundary: Literal["obrien-fleming", "pocock"] = "obrien-fleming"
    tau_method: Literal["dl", "reml"] = "dl"
    audit_nct_id: str = Field(default="", pattern=r"^(?:NCT\d{8})?$", max_length=11)
    audit_pmid: str = Field(default="", pattern=r"^\d{0,12}$", max_length=12)


class DesignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    design: WorkspaceDesign
    drug_or_class: str = Field(default="", max_length=300)
    evidence_sources: list[str] = Field(default_factory=lambda: [SRC_DEMO], max_length=9)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)

    @field_validator("evidence_sources")
    @classmethod
    def known_sources(cls, values: list[str]) -> list[str]:
        if any(value not in EVIDENCE_SOURCES for value in values):
            raise ValueError("Choose an available evidence source.")
        return list(dict.fromkeys(values))


def workspace_config() -> dict:
    return {
        "core_sources": CORE_EVIDENCE_SOURCES,
        "extra_sources": EXTRA_EVIDENCE_SOURCES,
        "demo_source": SRC_DEMO,
        "integrations": [item.model_dump() for item in integration_statuses()],
    }


def execute_design(request: DesignRequest) -> dict:
    result = run_design(
        TrialDesignInput(**request.design.model_dump()),
        request.drug_or_class,
        request.evidence_sources,
        **request.options.model_dump(),
    )
    payload = result.to_export_dict()
    # Record the source selection and analysis options as well as numeric inputs.
    payload["request"] = request.model_dump()
    if not result.evidence:
        payload["warnings"].append(
            "No evidence was gathered. This report uses a weakly informative fallback prior."
        )
    if SRC_DEMO in request.evidence_sources:
        payload["warnings"].append(
            "The seeded evidence is an illustrative Type 2 Diabetes / HbA1c demo. "
            "It is not evidence for other indications or binary endpoints."
        )
    # PDF is optional. A missing extra must never prevent JSON/Markdown results.
    try:
        pdf = base64.b64encode(result.to_pdf()).decode("ascii")
    except Exception:
        logger.info("Optional PDF export unavailable", exc_info=True)
        pdf = None
    return {"result": payload, "pdf_base64": pdf}


class WorkspaceHandler(BaseHTTPRequestHandler):
    server_version = "OpenTrial"

    def _reply(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        )
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, value: dict) -> None:
        self._reply(status, json.dumps(value, allow_nan=False).encode(), "application/json; charset=utf-8")

    def _local_request(self) -> bool:
        # Reject foreign Host/Origin values, including DNS rebinding to loopback.
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            self._json(403, {"error": "Use the local OpenTrial address."})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in hosts}:
            self._json(403, {"error": "OpenTrial accepts requests from its own workspace only."})
            return False
        return True

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        if not self._local_request():
            return
        path = urlsplit(self.path).path
        if path == "/api/config":
            self._json(200, workspace_config())
        elif path in ASSETS:
            name, content_type = ASSETS[path]
            self._reply(200, (STATIC_ROOT / name).read_bytes(), content_type)
        else:
            self._json(404, {"error": "This page does not exist."})

    def do_POST(self) -> None:
        if not self._local_request():
            return
        if urlsplit(self.path).path != "/api/design":
            self._json(404, {"error": "This endpoint does not exist."})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(415, {"error": "Send the design as JSON."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_BODY or self.headers.get("Transfer-Encoding"):
            self._json(413, {"error": "The design request is empty or too large."})
            return
        try:
            request = DesignRequest.model_validate_json(self.rfile.read(length))
        except ValidationError as exc:
            errors = [
                {"field": ".".join(map(str, issue["loc"])), "message": issue["msg"]}
                for issue in exc.errors(include_input=False, include_context=False, include_url=False)
            ]
            self._json(422, {"error": "Please check your trial inputs.", "details": errors})
            return
        if not _RUN_SLOT.acquire(blocking=False):
            self._json(409, {"error": "Another analysis is running. Please try again when it finishes."})
            return
        try:
            response = execute_design(request)
        except Exception:
            logger.exception("Design generation failed")
            self._json(500, {"error": "The report could not be generated. Check your inputs and try again."})
        else:
            self._json(200, response)
        finally:
            _RUN_SLOT.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="Open the OpenTrial design workspace.")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), WorkspaceHandler) as server:
        print(f"OpenTrial is ready at http://localhost:{server.server_address[1]}", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
