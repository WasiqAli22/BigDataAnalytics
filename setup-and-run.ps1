# # PowerShell script to set up and run QualitasCorpus processing
# # This script helps you get the QualitasCorpus and run the cljDetector

# Write-Host "=== QualitasCorpus Clone Detection Setup ===" -ForegroundColor Cyan
# Write-Host ""

# # Check if qc-volume exists
# $volumeExists = docker volume ls -q | Select-String -Pattern "^qc-volume$"
# if (-not $volumeExists) {
#     Write-Host "Creating docker volume 'qc-volume' for QualitasCorpus..." -ForegroundColor Yellow
#     docker volume create qc-volume
#     Write-Host "Volume created!" -ForegroundColor Green
# } else {
#     Write-Host "Volume 'qc-volume' already exists." -ForegroundColor Green
# }

# # Check if corpus tar files exist
# $tarFiles = Get-ChildItem "./Containers/CorpusGetter" -Filter "*.tar" -ErrorAction SilentlyContinue
# if ($tarFiles.Count -eq 0) {
#     Write-Host ""
#     Write-Host "WARNING: QualitasCorpus tar files not found in ./Containers/CorpusGetter/" -ForegroundColor Red
#     Write-Host "You need to:" -ForegroundColor Yellow
#     Write-Host "  1. Download QualitasCorpus-20130901r-pt1.tar and QualitasCorpus-20130901r-pt2.tar"
#     Write-Host "  2. Place them in ./Containers/CorpusGetter/"
#     Write-Host "  3. Then run this script again"
#     Write-Host ""
#     Write-Host "Alternatively, if you have the corpus elsewhere, you can:" -ForegroundColor Yellow
#     Write-Host "  - Copy it to ./QualitasCorpus/ and update all-at-once.yaml to use local mount"
#     Write-Host ""
#     exit 1
# }

# # Check if corpusgetter image exists
# $imageExists = docker images -q corpusgetter
# if (-not $imageExists) {
#     Write-Host "Building CorpusGetter image..." -ForegroundColor Yellow
#     docker build -t corpusgetter ./Containers/CorpusGetter
#     if ($LASTEXITCODE -ne 0) {
#         Write-Host "Failed to build CorpusGetter image!" -ForegroundColor Red
#         exit 1
#     }
#     Write-Host "CorpusGetter image built!" -ForegroundColor Green
# } else {
#     Write-Host "CorpusGetter image already exists." -ForegroundColor Green
# }

# # Check if corpus is installed in volume
# Write-Host ""
# Write-Host "Checking if QualitasCorpus is installed in volume..." -ForegroundColor Yellow
# $checkContainer = docker run --rm -v qc-volume:/QualitasCorpus corpusgetter test -d /QualitasCorpus/QualitasCorpus-20130901r/Systems
# if ($LASTEXITCODE -ne 0) {
#     Write-Host "QualitasCorpus not found in volume. Installing..." -ForegroundColor Yellow
#     Write-Host "This may take a while..." -ForegroundColor Yellow
#     Write-Host ""
    
#     docker run -it --rm `
#         -v qc-volume:/QualitasCorpus `
#         -v "${PWD}/Containers/CorpusGetter:/Download" `
#         corpusgetter ./qc-get.sh INSTALL
    
#     if ($LASTEXITCODE -ne 0) {
#         Write-Host "Failed to install QualitasCorpus!" -ForegroundColor Red
#         exit 1
#     }
#     Write-Host "QualitasCorpus installed successfully!" -ForegroundColor Green
# } else {
#     Write-Host "QualitasCorpus already installed in volume." -ForegroundColor Green
# }

# # Build cljDetector and MonitorTool images
# Write-Host ""
# Write-Host "Building cljDetector and MonitorTool images..." -ForegroundColor Yellow
# docker compose -f all-at-once.yaml build

# if ($LASTEXITCODE -ne 0) {
#     Write-Host "Failed to build images!" -ForegroundColor Red
#     exit 1
# }

# Write-Host ""
# Write-Host "=== Setup Complete! ===" -ForegroundColor Green
# Write-Host ""
# Write-Host "To start processing QualitasCorpus, run:" -ForegroundColor Cyan
# Write-Host "  docker compose -f all-at-once.yaml up" -ForegroundColor White
# Write-Host ""
# Write-Host "MonitorTool will be available at: http://localhost:8080" -ForegroundColor Cyan
# Write-Host ""
# Write-Host "To run with CLEAR flag (clears database first):" -ForegroundColor Yellow
# Write-Host "  docker compose -f all-at-once.yaml run clone-detector CLEAR" -ForegroundColor White
# Write-Host ""

