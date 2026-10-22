param([string]$BasePython = '', [switch]$SkipModels)
$ErrorActionPreference = 'Stop'
$studioRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $BasePython) {
    $BasePython = Join-Path $studioRoot '../tools/blender-4.5.14-windows-x64/4.5/python/bin/python.exe'
}
if (-not (Test-Path -LiteralPath $BasePython -PathType Leaf)) {
    throw 'Python 3.11 is required. Pass -BasePython with its full executable path.'
}
$vtonEnv = Join-Path $studioRoot 'runtime/vton-v4/.venv'
$vtonPython = Join-Path $vtonEnv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $vtonPython)) {
    & $BasePython -m venv $vtonEnv
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the isolated Python environment.' }
}
$env:PIP_CACHE_DIR = Join-Path $studioRoot 'runtime/pip-cache'
$env:PYTHONIOENCODING = 'utf-8'
& $vtonPython -m pip install --timeout 120 --retries 5 --extra-index-url https://download.pytorch.org/whl/cpu -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'CatVTON dependency installation failed.' }
if (-not $SkipModels) {
    & $vtonPython (Join-Path $PSScriptRoot 'setup_models.py')
    if ($LASTEXITCODE -ne 0) { throw 'Model download or integrity verification failed.' }
}
& $vtonPython -c 'import torch, diffusers, openvino; print("CPU runtime ready:", torch.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'Runtime import check failed.' }
$vtonConfig = Join-Path $studioRoot 'runtime/config.json'
if (-not $SkipModels -and -not (Test-Path -LiteralPath $vtonConfig)) {
    $vtonInitialConfig = @{ tryOn = @{ provider = 'local-catvton' }; motion = @{ provider = 'disabled'; enabled = $false } }
    $vtonInitialConfig | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $vtonConfig -Encoding utf8
}
Write-Output 'Installation complete. Local CatVTON uses CPU fp32; model files remain on this device.'
Write-Output 'Keep asset-sources/catvton-v4/upstream and its CC BY-NC-SA 4.0 license with the application.'
