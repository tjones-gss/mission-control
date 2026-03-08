import { Router } from 'express'
import { getAllTeams } from '../parsers/teams.js'

export const router = Router()

router.get('/', (req, res) => res.json(getAllTeams()))
