// api/queries/connection.ts - MySQL Connection
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { ResultSetHeader } from "mysql2/promise";
import * as schema from "../../db/schema";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "medrag",
  connectionLimit: 10,
  queueLimit: 0,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const db = drizzle(pool, { schema, mode: "default" });

// Helper to get insertId from MySQL insert result
// Drizzle ORM mysql2 insert returns [ResultSetHeader, FieldPacket[]]
export function getInsertId(
  result: [ResultSetHeader, unknown[]] | ResultSetHeader | { insertId: number | bigint }
): number {
  let id: number | bigint | undefined;
  if (Array.isArray(result)) {
    id = result[0]?.insertId;
  } else if ("insertId" in result) {
    id = result.insertId;
  }
  return typeof id === "bigint" ? Number(id) : (id as number) ?? 0;
}
