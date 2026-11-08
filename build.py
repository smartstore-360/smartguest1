#!/usr/bin/env python3
"""Builds gas/Index.html (the whole front end inlined, for the Apps Script-hosted copy).
GitHub Pages serves web/ directly, so nothing to build for it."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
web = root / 'web'
css = (web / 'styles.css').read_text()
def js(name):
    t = (web / name).read_text()
    assert '</script' not in t.lower(), name + ' contains </script'
    return t
html = f'''<!DOCTYPE html>
<html lang="en"><head><base target="_top"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmartGuest</title>
<style>
{css}
</style></head>
<body>
<div id="app"></div><div id="toasts" aria-live="polite"></div>
<script>
{js("api.js")}
</script>
<script>
{js("app.js")}
</script>
</body></html>
'''
(root / 'gas' / 'Index.html').write_text(html)
print('wrote gas/Index.html', len(html), 'bytes')
