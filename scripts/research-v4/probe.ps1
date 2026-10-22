$ErrorActionPreference = 'Stop'
$researchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $researchRoot)
$workspaceRoot = Split-Path -Parent $projectRoot
$pythonBase = Join-Path $workspaceRoot 'tools/blender-4.5.14-windows-x64/4.5/python/bin/python.exe'
$probePython = Join-Path $researchRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $probePython)) {
    & $pythonBase -m venv (Join-Path $researchRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated probe environment.' }
    & $probePython -m pip install -r (Join-Path $researchRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot install probe packages.' }
}
& $probePython (Join-Path $researchRoot 'openvino_probe.py')
if ($LASTEXITCODE -ne 0) { throw 'OpenVINO probe failed.' }
