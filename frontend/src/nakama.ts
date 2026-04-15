import { Client } from "@heroiclabs/nakama-js";

const host   = (import.meta.env.VITE_NAKAMA_HOST   as string) ?? "localhost";
const port   = (import.meta.env.VITE_NAKAMA_PORT   as string) ?? "7350";
const useSSL = (import.meta.env.VITE_NAKAMA_USE_SSL as string) === "true";

// Single shared Nakama HTTP client instance
// Constructor: new Client(serverKey, host, port, useSSL)
export const nakamaClient = new Client("defaultkey", host, port, useSSL);

// Exported so components can create sockets with the same SSL setting
export const nakamaSsl = useSSL;
