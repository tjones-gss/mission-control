import { Router } from 'express'
import { getAllSkills } from '../parsers/skills.js'

export const router = Router()

router.get('/', (req, res) => res.json(getAllSkills()))
