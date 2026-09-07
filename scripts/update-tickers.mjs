// 나스닥거래소가 공식으로 무료 공개하는 전체 상장종목 디렉토리 파일을 받아와서
// Invest Lab 대시보드의 "시장 전체" 티커 검색이 바로 쓸 수 있는 JSON으로 변환한다.
// 이 스크립트는 GitHub Actions 러너(서버)에서 실행되므로 브라우저 CORS/광고차단/무료
// 프록시 문제가 전혀 없다 — 실패해도 재시도만 하고, 절대 데이터를 지어내지 않는다.
//
// 출력: docs/data/tickers.json — [{ symbol, name, exch }, ...] 배열 그대로.
//       docs/data/meta.json    — 마지막 갱신 시각 등 참고 정보(대시보드는 안 읽어도 됨).

import { writeFile, mkdir } from "node:fs/promises";

const NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

async function fetchWithRetry(url, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "invest-lab-ticker-directory-bot" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2500 + attempt * 2500));
    }
  }
  throw lastErr;
}

// nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
function parseNasdaqListed(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split("|");
    if (f.length < 8) continue; // 헤더 이후 형식이 안 맞는 줄(파일 끝의 "File Creation Time" 등)은 건너뛴다
    const symbol = f[0].trim(), name = f[1].trim(), testIssue = f[3].trim();
    if (!symbol || testIssue === "Y") continue; // 테스트용 가짜 심볼 제외
    out.push({ symbol, name, exch: "NASDAQ" });
  }
  return out;
}

// otherlisted.txt: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
function parseOtherListed(text) {
  const lines = text.split("\n");
  const out = [];
  const exchMap = { N: "NYSE", A: "NYSE American", P: "NYSE Arca", Z: "BATS", V: "IEX" };
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split("|");
    if (f.length < 8) continue;
    const symbol = f[0].trim(), name = f[1].trim(), exch = f[2].trim(), testIssue = f[6].trim();
    if (!symbol || testIssue === "Y") continue;
    out.push({ symbol, name, exch: exchMap[exch] || exch || "—" });
  }
  return out;
}

async function main() {
  console.log("Fetching nasdaqlisted.txt ...");
  const nasdaqText = await fetchWithRetry(NASDAQ_URL);
  console.log("Fetching otherlisted.txt ...");
  const otherText = await fetchWithRetry(OTHER_URL);

  const items = parseNasdaqListed(nasdaqText).concat(parseOtherListed(otherText));
  if (!items.length) {
    throw new Error("Parsed 0 tickers — refusing to overwrite existing data with an empty file.");
  }

  await mkdir("docs/data", { recursive: true });
  await writeFile("docs/data/tickers.json", JSON.stringify(items));
  await writeFile(
    "docs/data/meta.json",
    JSON.stringify({ updatedAt: new Date().toISOString(), count: items.length }, null, 2)
  );
  console.log(`Wrote ${items.length} tickers to docs/data/tickers.json`);
}

main().catch((e) => {
  console.error("update-tickers failed:", e);
  process.exit(1);
});
