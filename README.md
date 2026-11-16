# markdown-render-speed-02-entry-v6

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/saifulsidik801-ship-it/markdown-render-speed-02-entry-v6/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/saifulsidik801-ship-it/markdown-render-speed-02-entry-v6/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free JavaScript markdown renderer. `parse(markdown)` returns byte-for-byte the HTML that marked 18.1.3 renders with its default options (GFM on) — every CommonMark 0.31.2 spec example, every GFM 0.29 extension example, and long generated READMEs — and it renders them faster than marked.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), renders each one with `parse()` from `parse.js`, and writes the HTML strings, in order, to `/output/html.json` (or `$MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=59gqp20q&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
