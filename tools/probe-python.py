import importlib
mods = {}
for name in ['matplotlib', 'numpy', 'PIL']:
    try:
        importlib.import_module(name)
        mods[name] = True
    except Exception as exc:
        mods[name] = str(exc)
print(mods)
