[CmdletBinding()]
param(
    [string]$SourceRoot = ('V:\Gumax' + [char]0x00AE + '\02. Beeldbank\02. Renders\01. Webshop afbeeldingen'),
    [string]$Destination = ('V:\Gumax' + [char]0x00AE + '\02. Beeldbank\02. Renders\01. Webshop afbeeldingen\12. Product feed (Dylan)'),
    [string[]]$SkipTopLevelFolders = @('01. Terrasoverkappingen')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "Source folder does not exist: $SourceRoot"
}

if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
    New-Item -ItemType Directory -Path $Destination | Out-Null
}

$imageExtensions = @(
    '.avif', '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg',
    '.png', '.svg', '.tif', '.tiff', '.webp'
)

$sourceRootPath = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$destinationPath = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\')

$searchRoots = Get-ChildItem -LiteralPath $sourceRootPath -Directory -ErrorAction Continue |
    Where-Object {
        $SkipTopLevelFolders -notcontains $_.Name -and
        -not $_.FullName.Equals($destinationPath, [System.StringComparison]::OrdinalIgnoreCase)
    }

$originalFolders = foreach ($searchRoot in $searchRoots) {
    if ($searchRoot.Name -eq 'Origineel') {
        $searchRoot
    }

    Get-ChildItem -LiteralPath $searchRoot.FullName -Directory -Recurse -ErrorAction Continue |
        Where-Object { $_.Name -eq 'Origineel' }
}

if ($SkipTopLevelFolders.Count -gt 0) {
    Write-Host "Skipping completed top-level folder(s): $($SkipTopLevelFolders -join ', ')"
}

$copied = 0
$skipped = 0
$failed = 0
$processed = 0

foreach ($originalFolder in $originalFolders) {
    $images = Get-ChildItem -LiteralPath $originalFolder.FullName -File -Recurse -ErrorAction Continue |
        Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() }

    foreach ($image in $images) {
        try {
            $target = Join-Path $destinationPath $image.Name

            # If a different image already has this filename, add its source path to
            # the name so no file is overwritten or lost.
            if (Test-Path -LiteralPath $target -PathType Leaf) {
                if ((Get-FileHash -LiteralPath $image.FullName).Hash -eq
                    (Get-FileHash -LiteralPath $target).Hash) {
                    $skipped++
                    continue
                }

                $relativeFolder = $originalFolder.Parent.FullName.Substring($sourceRootPath.Length).Trim('\')
                $safeFolderName = $relativeFolder -replace '[\\/:*?"<>|]', '_'
                $candidateName = '{0}__{1}{2}' -f $image.BaseName, $safeFolderName, $image.Extension
                $target = Join-Path $destinationPath $candidateName
                $number = 2

                while (Test-Path -LiteralPath $target -PathType Leaf) {
                    if ((Get-FileHash -LiteralPath $image.FullName).Hash -eq
                        (Get-FileHash -LiteralPath $target).Hash) {
                        $target = $null
                        $skipped++
                        break
                    }

                    $candidateName = '{0}__{1}__{2}{3}' -f $image.BaseName, $safeFolderName, $number, $image.Extension
                    $target = Join-Path $destinationPath $candidateName
                    $number++
                }
            }

            if ($null -ne $target) {
                Copy-Item -LiteralPath $image.FullName -Destination $target
                $copied++
            }
        }
        catch {
            $failed++
            Write-Warning "Could not process '$($image.FullName)': $($_.Exception.Message)"
        }
        finally {
            $processed++
            if ($processed % 100 -eq 0) {
                Write-Host "Processed $processed image(s): $copied copied, $skipped already present, $failed failed."
            }
        }
    }
}

Write-Host "Done. Processed $processed image(s): $copied copied, $skipped already present, $failed failed."
