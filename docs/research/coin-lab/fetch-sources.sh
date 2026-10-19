#!/bin/sh
# Downloads the CC0 / public-domain recordings the lab embeds into ./sources (not committed).
set -e
cd "$(dirname "$0")" && mkdir -p sources/online && cd sources
curl -sLO https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip
unzip -qo kenney_rpg-audio.zip -d rpg
curl -sL -o online/big2700.mp3 'https://bigsoundbank.com/UPLOAD/mp3/2700.mp3?v=d'
curl -sL -o online/oga-coin_drop.ogg https://opengameart.org/sites/default/files/coin_drop.ogg
curl -sL -o online/wiki-coin-floor.ogg https://upload.wikimedia.org/wikipedia/commons/c/c5/Coin_dropped_on_wooden_floor.ogg
