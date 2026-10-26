$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  node checks/contracts.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Contract checks failed' }
  node checks/lifecycle.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lifecycle checks failed; run cargo build --workspace first' }
} finally { Pop-Location }
