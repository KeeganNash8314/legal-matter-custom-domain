const base = process.env.SERVICE_URL ?? "http://localhost:3000";

const intake = await fetch(`${base}/matters`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    clientName: "Avery Chen",
    clientEmail: "avery@example.com",
    deadline: "2027-01-15T17:00:00.000Z",
  }),
});
const matter = (await intake.json()) as { id: string };

const delivery = await fetch(`${base}/matters/${matter.id}/signed-delivery`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ downloadUrl: "https://legal.example.com/documents/signed-nda" }),
});

console.log(JSON.stringify(await delivery.json(), null, 2));
