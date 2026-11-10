SmartGuest - complete GitHub Pages replacement (flat layout)

Upload everything in this folder to the TOP of your repository (not inside any folder), replacing files of the same name:
  index.html  styles.css  api.js  app.js  sw.js  manifest.webmanifest  icon.svg
Keep your own config.js (it is not included on purpose).
If your repository has a file called Index.html (capital I), delete it.

Then replace the workflow: .github/workflows/pages.yml  (a copy is also in pages.yml.txt - paste its text into
Add file > Create new file, name it .github/workflows/pages.yml). Wait for the green tick under Actions, then open the site and press Ctrl+F5.
The login screen should show  v2026.11.09-c  at the bottom.
