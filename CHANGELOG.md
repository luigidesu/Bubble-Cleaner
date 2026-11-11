# Changelog

## v1.1
The file is now just `Bubble Cleaner [Plastic Tears].jsx`, the version is written inside it. Updating from v1.0: delete `Bubble Cleaner v1.0 [Plastic Tears].jsx` from the Scripts folder when you add this one, or the menu shows it twice.

- Faster: the first run on a page takes about half the time (around 0.9s down to 0.5s on my T480). Every run after that is about 15% faster.
- Faster: `"colour"` with several colors selected at once. Three colors on a big page went from 5.3s to 3.2s.
- Faster: `"colour"` on a single colored bubble (cyan, red, yellow...). It used to take the slow road, about 2.9s, now about 0.8s.
- Added: `"colour"` works on Grayscale pages too. Gray bubbles keep their own gray instead of turning white or black. You can also write it as `"grayscale"`, it's the same mode.
- Fixed: in `"colour"`, a white bubble selected together with pale colored ones (light pink, light yellow...) got them all painted the same mixed color. Each one keeps its own now.
- Changed: the temporary channels it works in are now named `Bubble Cleaner ...` while it runs. They're still deleted at the end, and your own channels aren't touched.
- The white and black results are the same as v1.0.

## v1.0
- First public release.
