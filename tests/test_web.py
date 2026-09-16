"""Exercise the real HTTP boundary and its connection to the statistical engine."""

import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread

import pytest

from opentrial import web
from opentrial.workflow import SRC_DEMO, run_design


def request_body():
    return {
        "design": {
            "indication": "Type 2 Diabetes",
            "endpoint": "HbA1c change from baseline",
            "target_effect": 0.5,
            "alpha": 0.025,
            "desired_power": 0.8,
            "max_n_per_arm": 300,
        },
        "drug_or_class": "metformin",
        "evidence_sources": [SRC_DEMO],
    }


@pytest.fixture
def http():
    server = ThreadingHTTPServer(("127.0.0.1", 0), web.WorkspaceHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def send(method, path, payload=None, headers=None):
        conn = HTTPConnection(*server.server_address, timeout=10)
        body = json.dumps(payload) if payload is not None else None
        conn.request(method, path, body, {"Content-Type": "application/json", **(headers or {})})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    yield send
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def test_http_design_matches_existing_engine(http):
    body = request_body()
    status, _, raw = http("POST", "/api/design", body)
    assert status == 200
    payload = json.loads(raw)
    expected = run_design(web.TrialDesignInput(**body["design"]), "metformin", [SRC_DEMO])
    for key in ("grid", "recommendation", "prior", "decision", "evidence", "report_markdown"):
        assert payload["result"][key] == expected.to_export_dict()[key]
    assert payload["result"]["request"]["evidence_sources"] == [SRC_DEMO]
    assert any("illustrative" in warning for warning in payload["result"]["warnings"])


def test_binary_with_sensitivity_and_dropout_reaches_engine(http):
    body = request_body()
    body["design"].update(endpoint_type="binary", target_effect=0.15, baseline_proportion=0.3, dropout_rate=0.1)
    body["evidence_sources"] = []
    body["options"] = {"use_prior_sensitivity": True, "tau_method": "reml"}
    status, _, raw = http("POST", "/api/design", body)
    assert status == 200
    result = json.loads(raw)["result"]
    assert result["design"]["endpoint_type"] == "binary"
    assert result["design"]["dropout_rate"] == 0.1
    assert len(result["sensitivity"]) == 4
    assert result["prior"]["records_used"] == 0
    assert any("fallback prior" in warning for warning in result["warnings"])


@pytest.mark.parametrize("changes", [
    {"indication": "  "}, {"max_n_per_arm": 1000000},
    {"alpha": 0}, {"endpoint_sd": 0},
    {"endpoint_type": "binary", "baseline_proportion": 0.9, "target_effect": 0.5},
])
def test_invalid_design_returns_validation_error(http, changes):
    body = request_body()
    body["design"].update(changes)
    status, _, raw = http("POST", "/api/design", body)
    assert status == 422
    assert json.loads(raw)["details"]


@pytest.mark.parametrize("key,value", [
    ("evidence_sources", ["unknown"]),
    ("options", {"gs_n_looks": 100}),
    ("options", {"arbitrary_option": True}),
])
def test_invalid_source_or_option_rejected(http, key, value):
    body = request_body()
    body[key] = value
    assert http("POST", "/api/design", body)[0] == 422


def test_only_public_assets_and_sanitized_config_are_served(http):
    for path in ("/", "/styles.css", "/app.js", "/chart.js", "/appearance.js", "/favicon.svg"):
        status, headers, body = http("GET", path)
        assert status == 200 and body
        assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    for path in ("/.env", "/../.env", "/%2e%2e/.env", "/app.py", "/api/unknown"):
        assert http("GET", path)[0] == 404
    status, _, raw = http("GET", "/api/config")
    assert status == 200
    config = json.loads(raw)
    assert config["demo_source"] == SRC_DEMO
    assert all("api_key" not in item for item in config["integrations"])


def test_foreign_origin_host_and_non_json_are_rejected(http):
    body = request_body()
    assert http("POST", "/api/design", body, {"Origin": "https://foreign.example"})[0] == 403
    assert http("GET", "/api/config", headers={"Host": "foreign.example"})[0] == 403
    assert http("POST", "/api/design", body, {"Content-Type": "text/plain"})[0] == 415
    assert http("POST", "/api/design", {"oversized": "x" * web.MAX_BODY})[0] == 413


def test_missing_pdf_does_not_lose_the_report(monkeypatch):
    from opentrial.workflow import DesignResult

    def missing_pdf(self):
        raise RuntimeError("Optional export unavailable")

    monkeypatch.setattr(DesignResult, "to_pdf", missing_pdf)
    response = web.execute_design(web.DesignRequest.model_validate(request_body()))
    assert response["pdf_base64"] is None
    assert response["result"]["recommendation"]
    assert response["result"]["report_markdown"]


def test_failed_run_is_recoverable_and_concurrent_runs_are_bounded(http, monkeypatch):
    with web._RUN_SLOT:
        assert http("POST", "/api/design", request_body())[0] == 409
    original = web.execute_design

    def failed_run(_request):
        raise RuntimeError("private server details")

    monkeypatch.setattr(web, "execute_design", failed_run)
    status, _, body = http("POST", "/api/design", request_body())
    assert status == 500
    assert b"private server details" not in body
    monkeypatch.setattr(web, "execute_design", original)
    assert http("POST", "/api/design", request_body())[0] == 200
