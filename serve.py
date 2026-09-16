"""Launch the custom OpenTrial workspace against the existing Python engine."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from opentrial.web import main


if __name__ == "__main__":
    main()
