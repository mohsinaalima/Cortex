$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Virtual environment not found. Create it with: py -m venv venv"
}

Push-Location $projectRoot
try {
    # Ensure direct imports used by the API exist in the same interpreter that runs Uvicorn.
    & $python -c "import requests, bs4, fastapi, openai"
    if ($LASTEXITCODE -ne 0) {
        & $python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    }

    & $python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
}
finally {
    Pop-Location
}
