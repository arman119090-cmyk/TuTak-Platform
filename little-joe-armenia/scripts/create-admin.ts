/* Create (or re-activate with a new password) a back-office user.
 *
 *   pnpm admin:create -- --email owner@shop.am --name "Owner" --role OWNER
 *
 * The password is read from ADMIN_PASSWORD, or asked for interactively
 * (input hidden). Minimum 12 characters. Runs outside Next.js, so it builds
 * its own Prisma client and imports no server-only modules.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AdminRole } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";

const ROLES: AdminRole[] = ["OWNER", "MANAGER", "CONTENT"];

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}`);
  console.error('Usage: pnpm admin:create -- --email <email> --name "<name>" --role OWNER|MANAGER|CONTENT [--update]');
  console.error("Password: ADMIN_PASSWORD env var, otherwise prompted (min 12 characters).");
  process.exit(1);
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) usage("no TTY to prompt for a password; set ADMIN_PASSWORD");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Hide typed characters: print the prompt, then only line breaks.
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      } else if (s.includes("\n") || s.includes("\r")) out.output.write("\n");
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "MANAGER" },
      update: { type: "boolean", default: false },
    },
    strict: true,
  });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  const role = values.role?.toUpperCase() as AdminRole;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage("--email is required and must be valid");
  if (!name) usage("--name is required");
  if (!ROLES.includes(role)) usage(`--role must be one of ${ROLES.join(", ")}`);
  if (!process.env.DATABASE_URL) usage("DATABASE_URL is not set");

  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    password = await promptHidden("Password (min 12 chars): ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) usage("passwords do not match");
  }
  if (password.length < 12) usage("password must be at least 12 characters");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const existing = await db.adminUser.findUnique({ where: { email } });
    if (existing && !values.update) usage(`${email} already exists (pass --update to reset password/role and re-activate)`);
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const user = existing
        ? await tx.adminUser.update({ where: { email }, data: { name, role, passwordHash, isActive: true } })
        : await tx.adminUser.create({ data: { email, name, role, passwordHash } });
      if (existing) await tx.adminSession.deleteMany({ where: { adminId: user.id } });
      await tx.auditLog.create({
        data: { actor: "cli", action: existing ? "admin_user.cli_update" : "admin_user.cli_create", entity: "AdminUser", entityId: user.id, data: { email, role } },
      });
    });
    console.info(`${existing ? "Updated" : "Created"} ${role} ${email}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
