# Development tools

`render-board.mts` renders the mansion to `docs/board-preview.png` without a
browser, which is handy for reviewing the artwork in a pull request:

```bash
npm i --no-save @resvg/resvg-js
npx tsx tools/render-board.mts        # writes /tmp/board.svg from a mid-game state
npx tsx tools/rasterize.mts           # rasterises it to /tmp/board.png
```

Neither script is part of the build or the test suite.
