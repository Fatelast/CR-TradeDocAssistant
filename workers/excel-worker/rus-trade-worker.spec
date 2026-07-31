# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files


WORKER_ROOT = Path(SPECPATH)
SOURCE_ROOT = WORKER_ROOT / "src"

analysis = Analysis(
    [str(SOURCE_ROOT / "main.py")],
    pathex=[str(SOURCE_ROOT)],
    binaries=[],
    datas=collect_data_files("openpyxl"),
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="rus-trade-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)

distribution = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="rus-trade-worker",
)
