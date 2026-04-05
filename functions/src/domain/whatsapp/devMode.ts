export type DevCommand =
  | { kind: "help" }
  | { kind: "exit" }
  | { kind: "tenant_status" }
  | { kind: "deposito_open"; depositoId: string }
  | { kind: "deposito_close"; depositoId: string }
  | { kind: "deposito_pause"; depositoId: string; minutes: number }
  | { kind: "pedido_reroute"; orderId: string }
  | {
      kind: "deposito_create";
      cnpj: string;
      nome: string;
      wa: string;
      bairro: string;
      cidade: string;
    }
  | { kind: "unknown"; raw: string };

function sanitizeId(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, "");
}

function parseCadastroPayload(rawText: string): DevCommand | null {
  const raw = String(rawText ?? "");
  const marker = /dev\s+deposito\s+cadastrar\s+/i;
  if (!marker.test(raw)) return null;
  const payload = raw.replace(marker, "").trim();
  if (!payload) return { kind: "unknown", raw };
  const entries = payload
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, ...rest] = part.split("=");
      return {
        key: String(key ?? "").trim().toLowerCase(),
        value: rest.join("=").trim(),
      };
    });
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.key || !entry.value) continue;
    map.set(entry.key, entry.value);
  }
  const cnpj = String(map.get("cnpj") ?? "").replace(/[^\d]/g, "");
  const nome = String(map.get("nome") ?? "").trim();
  const wa = String(map.get("wa") ?? "").replace(/[^\d]/g, "");
  const bairro = String(map.get("bairro") ?? "").trim();
  const cidade = String(map.get("cidade") ?? "").trim();
  if (!cnpj || !nome || !wa || !bairro || !cidade) {
    return { kind: "unknown", raw };
  }
  return {
    kind: "deposito_create",
    cnpj,
    nome,
    wa,
    bairro,
    cidade,
  };
}

export function parseDevCommand(params: {
  normalizedText: string;
  rawText: string;
}): DevCommand {
  const compact = String(params.normalizedText ?? "").trim();

  if (!compact || !compact.startsWith("dev")) {
    return { kind: "unknown", raw: compact };
  }
  if (compact === "dev mode" || compact === "dev help" || compact === "dev menu") {
    return { kind: "help" };
  }
  if (compact === "dev sair" || compact === "dev off") {
    return { kind: "exit" };
  }
  if (compact === "dev tenant status") {
    return { kind: "tenant_status" };
  }

  const cadastro = parseCadastroPayload(params.rawText);
  if (cadastro) return cadastro;

  const rerouteMatch = compact.match(/^dev\s+pedido\s+reroute\s+(.+)$/);
  if (rerouteMatch?.[1]) {
    return {
      kind: "pedido_reroute",
      orderId: sanitizeId(rerouteMatch[1]),
    };
  }

  const openMatch = compact.match(/^dev\s+deposito\s+abrir\s+(.+)$/);
  if (openMatch?.[1]) {
    return {
      kind: "deposito_open",
      depositoId: sanitizeId(openMatch[1]),
    };
  }
  const closeMatch = compact.match(/^dev\s+deposito\s+fechar\s+(.+)$/);
  if (closeMatch?.[1]) {
    return {
      kind: "deposito_close",
      depositoId: sanitizeId(closeMatch[1]),
    };
  }
  const pauseMatch = compact.match(/^dev\s+deposito\s+pausar\s+(.+?)\s+(\d{1,4})$/);
  if (pauseMatch?.[1] && pauseMatch?.[2]) {
    const minutes = Number(pauseMatch[2]);
    return {
      kind: "deposito_pause",
      depositoId: sanitizeId(pauseMatch[1]),
      minutes: Math.max(5, Math.min(720, Math.floor(minutes))),
    };
  }

  return { kind: "unknown", raw: compact };
}

export function composeDevHelpMessage(): string {
  return [
    "Dev mode ativo.",
    "Comandos:",
    "- dev tenant status",
    "- dev deposito abrir <id>",
    "- dev deposito fechar <id>",
    "- dev deposito pausar <id> <min>",
    "- dev pedido reroute <orderId>",
    "- dev deposito cadastrar cnpj=<...>;nome=<...>;wa=<...>;bairro=<...>;cidade=<...>",
    "- dev sair",
  ].join("\n");
}

