#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js，请先安装 Node 22 或更高版本：https://nodejs.org/"
  exit 1
fi

node start-public.js "$@"
