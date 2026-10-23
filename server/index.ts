import app from './app.ts'

const port = Number(process.env.PORT ?? 3102)
app.listen(port, () => console.log(`Bóveda API en http://localhost:${port}`))
