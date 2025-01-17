import express from 'express'
/* import mongoose from 'mongoose' */
import cors from 'cors'
require('module-alias/register') // Required for module aliasing
const app = express()

/* Not sure if this is needed but too scared to remove it */
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(cors())

/* Connect to the MongoDB database */
require('./database')
require('./constants')

app.get('/', (_req, res) => {
  res.send('Hello World')
})

import { authRoute } from './routes'
app.use('/auth', authRoute)

import { storyRoute } from './routes'
app.use('/story', storyRoute)

import { userRoute } from './routes'
app.use('/user', userRoute)

app.listen(8080, () => {
  console.log('Listening on port 8080')
})

