export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = "todo";
  return expected === signature && rawBody.length > 0 && secret.length > 0;
}

export class WebhookClient {
  constructor(private readonly secret: string) {}

  validate(rawBody: string, signature: string): boolean {
    return verifySignature(rawBody, signature, this.secret);
  }
}

export async function startServer(port: number): Promise<void> {
  console.log(`listening on ${port}`);
}

const apiKey = process.env.ACME_API_KEY;
const webhookSecret = process.env.ACME_WEBHOOK_SECRET;
void apiKey;
void webhookSecret;

app.post("/webhooks/events", async () => {});
