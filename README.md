# The World in One Page — Saturday 21 November 2026

[![news-image-20261121](https://make.fun/badge/news-image-20261121.svg)](https://make.fun/c/news-image-20261121)
[![rank](https://make.fun/badge/news-image-20261121/zxpast/makefun-news-image-20261121/rank.svg)](https://make.fun/c/news-image-20261121)
[![reward](https://make.fun/badge/news-image-20261121/zxpast/makefun-news-image-20261121/reward.svg)](https://make.fun/c/news-image-20261121)

A make.fun entry for [news-image-20261121](https://make.fun/bounty/news-image-20261121): a program that draws one
1024×1024 broadsheet image summing up the world's news of Saturday
21 November 2026.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program uses only the Node standard library, writes `entry.png`
(1024×1024, at most 1 MiB), and is deterministic: two runs write
identical bytes.

## The image

37 stories across 6 regions: 3 hero stories, 10 illustrated cards,
24 briefs, plus a stat strip, a region strip, a world map with numbered
pins, and a DATE CHECK box listing the near-miss stories that broke on
an earlier day. Everything is drawn procedurally, including a
single-stroke vector font and a hand-rolled PNG encoder. No network,
no photographs.

## Prizes

$100 in total: 1st $20, 2nd $12, 3rd $6, 4th–10th $2, 11th–50th $1.20.
