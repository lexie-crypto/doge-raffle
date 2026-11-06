import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionResult, parseAbi, toHex } from "viem";

const abi = parseAbi([
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (uint64 startTime, uint64 endTime, uint64 randomnessBlock, uint8 status, uint16 feeBps, uint16 foundationBps, uint96 totalTickets, uint256 pot, address winner)",
  "function canCommit() view returns (bool)",
  "function vrfRequestOf(uint256) view returns (uint256)",
  "function canFinalize() view returns (bool)",
]);

test("a committed VRF round leaves the draw step successful so the oracle can run", async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    calls.push(rpc.method);
    let result;
    if (rpc.method === "eth_chainId") {
      result = toHex(6281971);
    } else if (rpc.method === "eth_call") {
      const { functionName } = decodeFunctionData({ abi, data: rpc.params[0].data });
      const values = {
        currentRoundId: 1n,
        rounds: [0n, 0n, 11n, 1, 500, 500, 1n, 20n * 10n ** 18n, "0x0000000000000000000000000000000000000000"],
        canCommit: false,
        vrfRequestOf: 1n,
        canFinalize: false,
      };
      result = encodeFunctionResult({ abi, functionName, result: values[functionName] });
    } else {
      response.writeHead(500);
      response.end(`unexpected RPC method: ${rpc.method}`);
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const child = spawn(process.execPath, ["draw-bot.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        RPC_URL: `http://127.0.0.1:${port}`,
        RAFFLE_ADDRESS: "0x1111111111111111111111111111111111111111",
        BOT_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      },
    });
    let output = "";
    for await (const chunk of child.stdout) output += chunk;
    for await (const chunk of child.stderr) output += chunk;
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, output);
    assert.match(output, /awaits VRF fulfillment or fallback timeout/);
    assert.ok(!calls.includes("eth_sendRawTransaction"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
