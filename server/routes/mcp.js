import { Router } from 'express'
import { getMcpServers } from '../parsers/mcp.js'

const router = Router()

router.get('/', (req, res) => {
  try {
    const servers = getMcpServers()
    res.json({ servers })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read MCP server config' })
  }
})

export default router
