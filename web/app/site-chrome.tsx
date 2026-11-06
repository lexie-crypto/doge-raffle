"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useReadContracts } from "wagmi";
import { raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, VRF_COORDINATOR_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { ConnectWallet } from "./connect";
import { DogeCoin } from "./doge";

const explorer = dogeosChikyu.blockExplorers.default.url;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const LINKS = [
  { href: "/#how", label: "How it works", page: "/" },
  { href: "/my-tickets", label: "My tickets", page: "/my-tickets" },
  { href: "/my-tickets#draws", label: "Past draws", page: "" },
  { href: "/vrf", label: "VRF", page: "/vrf" },
  { href: "/docs", label: "Docs", page: "/docs" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-40 border-b border-amber-200/70 bg-[#fdf6e3]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <DogeCoin size={34} className="bob" />
          <span className="display text-xl font-bold tracking-tight text-amber-950 sm:text-2xl">Doge Raffle</span>
        </Link>
        <div className="hidden items-center gap-1 text-sm font-semibold text-amber-900/80 lg:flex">
          {LINKS.map((l) => {
            const active = l.page !== "/" && l.page !== "" && pathname.startsWith(l.page);
            const isVrf = l.label === "VRF";
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 transition hover:bg-amber-100 hover:text-amber-700 ${
                  active ? "bg-amber-950 text-amber-300 hover:bg-amber-900 hover:text-amber-200" : ""
                } ${isVrf && !active ? "text-amber-700" : ""}`}
              >
                {l.label}
                {isVrf && (
                  <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-amber-950">
                    new
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <ConnectWallet />
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-amber-300 bg-white text-lg font-bold text-amber-900 lg:hidden"
            aria-label="Menu"
            aria-expanded={open}
          >
            {open ? "×" : "≡"}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-amber-200 bg-[#fdf6e3] px-4 py-3 lg:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="display block rounded-xl px-3 py-2.5 text-lg font-bold text-amber-950 hover:bg-amber-100"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

export function SiteFooter() {
  const { data } = useReadContracts({
    contracts: [
      { address: RAFFLE_ADDRESS, abi: raffleAbi, functionName: "foundationWallet" as const },
      { address: RAFFLE_ADDRESS, abi: raffleAbi, functionName: "treasury" as const },
    ],
  });
  const foundationAddr = data?.[0]?.result as string | undefined;
  const treasuryAddr = data?.[1]?.result as string | undefined;
  const rows: [string, string | undefined][] = [
    ["Raffle contract", RAFFLE_ADDRESS],
    ["VRF coordinator", VRF_COORDINATOR_ADDRESS],
    ["Dogecoin Foundation wallet", foundationAddr],
    ["Protocol wallet", treasuryAddr],
  ];
  return (
    <footer className="relative overflow-hidden bg-amber-950 text-amber-100/80">
      <div className="pointer-events-none absolute -right-16 -top-16 opacity-10">
        <DogeCoin size={360} />
      </div>
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.1fr_0.6fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <DogeCoin size={52} />
            <span className="display text-3xl font-bold text-amber-200">Doge Raffle</span>
          </div>
          <p className="mt-4 max-w-md">
            A monthly DOGE jackpot and a verifiable randomness service, running entirely on smart
            contracts on{" "}
            <a href="https://dogeos.com" target="_blank" rel="noreferrer" className="font-semibold text-amber-300 underline">
              DogeOS
            </a>
            , the app layer for Dogecoin.
          </p>
          <p className="mt-4 text-xs text-amber-100/50">
            Testnet only — not an offer to gamble. Paid raffles are regulated in many jurisdictions.
            Dogecoin artwork from the Dogecoin Core project (MIT). Not affiliated with or endorsed by
            the Dogecoin Foundation.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="display mb-3 text-lg font-bold text-amber-200">Explore</div>
          <Link href="/" className="block hover:text-amber-300">Raffle</Link>
          <Link href="/my-tickets" className="block hover:text-amber-300">My tickets & past draws</Link>
          <Link href="/#faq" className="block hover:text-amber-300">FAQ</Link>
          <Link href="/vrf" className="block hover:text-amber-300">DogeOS VRF</Link>
          <Link href="/docs" className="block hover:text-amber-300">Developer docs</Link>
          <a href="https://github.com/lexie-crypto/doge-raffle" className="block hover:text-amber-300">Source code</a>
        </div>
        <div className="space-y-2 text-sm">
          <div className="display mb-3 text-lg font-bold text-amber-200">Verify it yourself</div>
          {rows.map(([label, addr]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-amber-100/10 pb-2">
              <span>{label}</span>
              {addr ? (
                <a className="font-mono text-amber-300 underline" href={`${explorer}/address/${addr}`} target="_blank" rel="noreferrer">
                  {short(addr)}
                </a>
              ) : (
                <span className="text-amber-100/40">…</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
