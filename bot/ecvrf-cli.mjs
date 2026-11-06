// CLI for Foundry ffi tests and manual proving.
//
//   node ecvrf-cli.mjs pubkey <skHex>
//     -> 0x-hex of abi.encode(uint256 pkx, uint256 pky)
//   node ecvrf-cli.mjs prove <skHex> <seedHex>
//     -> 0x-hex of abi.encode(VRF.Proof) (13 static words)

import { encodeProof, prove, publicKey } from "./ecvrf.mjs";

const [, , cmd, skHex, seedHex] = process.argv;

function big(hexOrDec) {
  if (hexOrDec === undefined) throw new Error("missing argument");
  return hexOrDec.startsWith("0x") ? BigInt(hexOrDec) : BigInt("0x" + hexOrDec);
}

const hex32 = (n) => n.toString(16).padStart(64, "0");

if (cmd === "pubkey") {
  const [x, y] = publicKey(big(skHex));
  process.stdout.write("0x" + hex32(x) + hex32(y));
} else if (cmd === "prove") {
  const proof = prove(big(skHex), big(seedHex));
  process.stdout.write(encodeProof(proof));
} else {
  console.error("usage: ecvrf-cli.mjs pubkey <skHex> | prove <skHex> <seedHex>");
  process.exit(1);
}
