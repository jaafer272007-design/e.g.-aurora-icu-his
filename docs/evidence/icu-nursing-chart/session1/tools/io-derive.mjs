// Runs the SHIPPED client derivation (src/lib/api/ioSnapshots.ts, transpiled to $IO_MODULE) on
// observations read from the real API (stdin: {patientId, encounterId, observations}).
const { deriveIoView } = await import(process.env.IO_MODULE)
let input = ''
for await (const chunk of process.stdin) input += chunk
const { patientId, encounterId, observations } = JSON.parse(input)
process.stdout.write(JSON.stringify(deriveIoView(patientId, encounterId, observations)))
