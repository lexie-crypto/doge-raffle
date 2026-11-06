// ECVRF prover matching Chainlink's secp256k1 VRF verifier (VRF.sol, MIT),
// vendored at contracts/src/vrf/vendor/VRF.sol. Every hash/packing below
// mirrors that contract exactly — change nothing without changing both.
//
// Proof layout (VRF.Proof): pk[2], gamma[2], c, s, seed, uWitness(address),
// cGammaWitness[2], sHashWitness[2], zInv.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const Point = secp256k1.Point;
const P = secp256k1.Point.Fp.ORDER; // field prime
const N = secp256k1.Point.Fn.ORDER; // group order
const G = Point.BASE;

// ---------------------------------------------------------------- utils

const mod = (a, m) => ((a % m) + m) % m;

function modPow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

const modInv = (a, m) => modPow(mod(a, m), m - 2n, m); // m prime

/** 32-byte big-endian encoding of a bigint. */
function be32(n) {
  const out = new Uint8Array(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function concat(...arrays) {
  const len = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const keccakBig = (bytes) =>
  BigInt("0x" + Buffer.from(keccak_256(bytes)).toString("hex"));

const hex32 = (n) => Buffer.from(be32(n)).toString("hex");

// ------------------------------------------------- VRF.sol mirror functions

/** VRF.sol _fieldHash: keccak, re-hash while >= FIELD_SIZE. */
function fieldHash(bytes) {
  let x = keccakBig(bytes);
  while (x >= P) x = keccakBig(be32(x));
  return x;
}

const ySquared = (x) => mod(x * x * x + 7n, P);

/** sqrt in GF(P), P ≡ 3 mod 4. May return garbage when input is not a QR —
 * caller checks isOnCurve, exactly like VRF.sol. */
const sqrtField = (x) => modPow(x, (P + 1n) / 4n, P);

const isOnCurve = (x, y) => x < P && y < P && mod(y * y, P) === ySquared(x);

/** VRF.sol _newCandidateSecp256k1Point: x = fieldHash(b), even-y point. */
function newCandidatePoint(bytes) {
  const x = fieldHash(bytes);
  let y = sqrtField(ySquared(x));
  if (y % 2n === 1n) y = P - y;
  return [x, y];
}

/** VRF.sol _hashToCurve(pk, input), HASH_TO_CURVE_HASH_PREFIX = 1. */
export function hashToCurve(pk, input) {
  let p = newCandidatePoint(concat(be32(1n), be32(pk[0]), be32(pk[1]), be32(input)));
  while (!isOnCurve(p[0], p[1])) {
    p = newCandidatePoint(be32(p[0]));
  }
  return p;
}

/** Ethereum address (as bigint) of an affine point: last 20 bytes of
 * keccak(abi.encodePacked(x, y)) — mirrors VRF.sol's _ecmulVerify expected. */
function pointAddress(pt) {
  return keccakBig(concat(be32(pt[0]), be32(pt[1]))) & ((1n << 160n) - 1n);
}

/** VRF.sol _scalarFromCurvePoints, SCALAR_FROM_CURVE_POINTS_HASH_PREFIX = 2.
 * Packing: uint256(2) ‖ hash[2] ‖ pk[2] ‖ gamma[2] ‖ v[2] ‖ uWitness(20 bytes). */
function scalarFromCurvePoints(hashPt, pk, gamma, uWitnessAddr, v) {
  const addr20 = be32(uWitnessAddr).slice(12); // bottom 20 bytes
  return keccakBig(
    concat(
      be32(2n),
      be32(hashPt[0]),
      be32(hashPt[1]),
      be32(pk[0]),
      be32(pk[1]),
      be32(gamma[0]),
      be32(gamma[1]),
      be32(v[0]),
      be32(v[1]),
      addr20,
    ),
  );
}

/** VRF.sol _projectiveSub: (x1/z1 - x2/z2) in P¹. */
function projectiveSub(x1, z1, x2, z2) {
  const num1 = mod(z2 * x1, P);
  const num2 = mod((P - x2) * z1, P);
  return [mod(num1 + num2, P), mod(z1 * z2, P)];
}

/** VRF.sol _projectiveMul. */
function projectiveMul(x1, z1, x2, z2) {
  return [mod(x1 * x2, P), mod(z1 * z2, P)];
}

/** VRF.sol _projectiveECAdd for two distinct affine points — returns the
 * projective (sx, sy, sz) whose sz the verifier needs inverted (zInv). */
export function projectiveECAdd(px, py, qx, qy) {
  const z1 = 1n;
  const z2 = 1n;
  const lx = mod(qy + P - py, P);
  const lz = mod(qx + P - px, P);

  let [sx, dx] = projectiveMul(lx, lz, lx, lz);
  [sx, dx] = projectiveSub(sx, dx, px, z1);
  [sx, dx] = projectiveSub(sx, dx, qx, z2);

  let [sy, dy] = projectiveSub(px, z1, sx, dx);
  [sy, dy] = projectiveMul(sy, dy, lx, lz);
  [sy, dy] = projectiveSub(sy, dy, py, z1);

  let sz;
  if (dx !== dy) {
    sx = mod(sx * dy, P);
    sy = mod(sy * dx, P);
    sz = mod(dx * dy, P);
  } else {
    sz = dx;
  }
  return [sx, sy, sz];
}

// ----------------------------------------------------------------- prover

const toAffine = (pt) => {
  const a = pt.toAffine();
  return [a.x, a.y];
};

const fromAffine = ([x, y]) => Point.fromAffine({ x, y });

/** Public key (affine [x, y]) for a secret key bigint. */
export function publicKey(sk) {
  return toAffine(G.multiply(mod(sk, N)));
}

/** VRF output for a gamma point: keccak(abi.encode(3, gamma)). */
export function outputFromGamma(gamma) {
  return keccakBig(concat(be32(3n), be32(gamma[0]), be32(gamma[1])));
}

/**
 * Generate a proof for `seed` (uint256 bigint) under secret key `sk`.
 * Returns all VRF.Proof fields as bigints (uWitness as 160-bit bigint),
 * plus the implied `output`.
 */
export function prove(sk, seed) {
  sk = mod(sk, N);
  if (sk === 0n) throw new Error("zero secret key");
  const pk = publicKey(sk);
  const h = hashToCurve(pk, seed);
  const hPoint = fromAffine(h);
  const gamma = toAffine(hPoint.multiply(sk));

  // deterministic nonce; retry counter handles (astronomically unlikely)
  // degenerate c/s values the verifier rejects
  for (let ctr = 0n; ctr < 32n; ctr++) {
    const k =
      mod(
        keccakBig(
          concat(be32(sk), be32(seed), be32(ctr), Buffer.from("doge-vrf-nonce")),
        ),
        N - 1n,
      ) + 1n;

    const u = toAffine(G.multiply(k));
    const v = toAffine(hPoint.multiply(k));
    const uWitness = pointAddress(u);
    const c = scalarFromCurvePoints(h, pk, gamma, uWitness, v);
    const cModN = mod(c, N);
    const s = mod(k - cModN * sk, N);
    if (cModN === 0n || s === 0n) continue; // verifier rejects zero scalars

    const cGammaWitness = toAffine(fromAffine(gamma).multiply(cModN));
    const sHashWitness = toAffine(hPoint.multiply(s));
    if (cGammaWitness[0] === sHashWitness[0]) continue; // must be distinct

    const [, , z] = projectiveECAdd(
      cGammaWitness[0],
      cGammaWitness[1],
      sHashWitness[0],
      sHashWitness[1],
    );
    const zInv = modInv(z, P);

    return {
      pk,
      gamma,
      c,
      s,
      seed,
      uWitness,
      cGammaWitness,
      sHashWitness,
      zInv,
      output: outputFromGamma(gamma),
    };
  }
  throw new Error("could not produce a valid proof (nonce exhaustion)");
}

/** abi.encode(Proof) — 13 static words — as a 0x hex string. */
export function encodeProof(proof) {
  const words = [
    proof.pk[0],
    proof.pk[1],
    proof.gamma[0],
    proof.gamma[1],
    proof.c,
    proof.s,
    proof.seed,
    proof.uWitness, // address right-aligned in its word
    proof.cGammaWitness[0],
    proof.cGammaWitness[1],
    proof.sHashWitness[0],
    proof.sHashWitness[1],
    proof.zInv,
  ];
  return "0x" + words.map(hex32).join("");
}
