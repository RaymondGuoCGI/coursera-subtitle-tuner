Coursera Subtitle Tuner - MVP

Install:
1) Open Chrome -> chrome://extensions
2) Enable Developer mode
3) Click "Load unpacked" and select this folder.

Test:
- Open a Coursera video page
- You should see a "CC+" button on/near the video controls.
- Click it to open subtitle settings panel.

Notes:
- Coursera DOM changes frequently. If button doesn't appear, refresh when video is visible.
- To support more websites, add them to manifest host_permissions/matches and add a site adapter in content.js.
