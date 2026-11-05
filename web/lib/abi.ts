import { parseAbi } from "viem";

export const raffleAbi = parseAbi([
  "struct Bundle { uint32 tickets; uint224 price; }",
  "function buyTickets(uint256 bundleId) payable",
  "function withdrawPayout()",
  "function commitDraw()",
  "function finalizeDraw()",
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (uint64 startTime, uint64 endTime, uint64 randomnessBlock, uint8 status, uint96 totalTickets, uint256 pot, address winner, uint256 prize)",
  "function ticketsOf(uint256 roundId, address user) view returns (uint256)",
  "function allBundles() view returns (Bundle[])",
  "function withdrawable(address) view returns (uint256)",
  "function canCommit() view returns (bool)",
  "function canFinalize() view returns (bool)",
  "function feeBps() view returns (uint256)",
  "event TicketsPurchased(uint256 indexed roundId, address indexed buyer, uint256 bundleId, uint256 tickets, uint256 paid)",
  "event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint256 prize, uint256 fee, uint256 totalTickets)",
]);
