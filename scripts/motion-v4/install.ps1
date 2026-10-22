param([string]$BasePython = '')
$ErrorActionPreference = 'Stop'
$studioRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $BasePython) {
    $BasePython = Join-Path $studioRoot '../tools/blender-4.5.14-windows-x64/4.5/python/bin/python.exe'
}
$venvRoot = Join-Path $studioRoot 'runtime/motion-v4/.venv'
$motionPython = Join-Path $venvRoot 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $motionPython)) {
    & $BasePython -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated Python environment' }
}
$env:PIP_CACHE_DIR = Join-Path $studioRoot 'runtime/pip-cache'
& $motionPython -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r (Join-Path $PSScriptRoot 'requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
Write-Output "Isolated runtime: $motionPython"
Write-Output 'Source and checkpoint: see docs/motion-v4.md. No GPU/CUDA packages required.'
