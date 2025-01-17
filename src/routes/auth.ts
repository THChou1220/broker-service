import express from 'express'
import axios from 'axios'
import jwt from 'jsonwebtoken'
import 'dotenv/config'
import crypto from 'crypto'
import { User, Token } from '../models'
import { sendMail, resetPassword } from './auth.utils'
import { JWT_SECRET } from '../constants'

// Return type of login
interface IUser {
  name: string
  email: string
  avatar: string
  jwtToken: string
  id: string
}

const router = express.Router()

/* foundUser = {
 * username: string,
 * email: string,
 * password: string,
 * }
 */

router.post('/google', async (req, res) => {
  const id_token = req.body.id_token
  const { data } = await axios.get(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${id_token}`
  )
  if (data['email_verified'] == 'true') {
    console.log('Email verified')
    const foundUser = await User.findOne({
      email: data['email'],
    })
    if (!foundUser) {
      /* Create new user if not found */
      try {
        const newUser = new User({
          username: data['name'],
          email: data['email'],
          avatar: data['picture'],
        })
        await newUser.save()
      } catch (err) {
        console.log(err)
        return res.status(500).send({ message: 'Error creating user' })
      }
    }

    const jwt_token = jwt.sign(
      {
        name: data['name'],
        email: data['email'],
        id: foundUser?._id,
      },
      JWT_SECRET,
      { expiresIn: '180d' } // 180 days
    )
    const user: IUser = {
      name: data['name'],
      email: data['email'],
      avatar: data['picture'],
      jwtToken: jwt_token,
      id: foundUser?._id,
    }
    return res.status(200).send(user)
  } else {
    return res.status(401).send({ message: 'Email not verified' })
  }
})

router.post('/credentials', async (req, res) => {
  /* Check if user exists in database */
  let foundUser = await User.findOne({
    email: req.body.email,
  })

  if (!foundUser) {
    return res.status(401).send({ message: 'User does not exist' })
  }

  // Login with social media and haven't set password
  if (!foundUser.password) {
    return res
      .status(401)
      .send({ message: 'User not registered or signed in with social media' })
  }

  /* Check if password matches */
  foundUser.comparePassword(req.body.password, (err: Error, isMatch: any) => {
    if (err) {
      return res.status(500).send({ message: 'Error comparing password' })
    }
    if (!isMatch) {
      return res.status(401).send({ message: 'Password does not match' })
    }

    /* Create JWT token */
    const jwtToken = jwt.sign(
      {
        name: foundUser?.username,
        email: foundUser?.email,
        id: foundUser?._id,
      },
      JWT_SECRET,
      { expiresIn: '180d' } // 180 days
    )

    const user: IUser = {
      name: foundUser?.username as string,
      email: foundUser?.email as string,
      avatar: foundUser?.avatar as string,
      jwtToken: jwtToken,
      id: foundUser?._id as string,
    }

    return res.status(200).send(user)
  })
})

router.post('/register', async (req, res) => {
  /* Check if user exists in database */
  let foundUser = await User.findOne({
    email: req.body.email,
  })
  if (foundUser) {
    return res.status(401).send({ message: 'User already exists' })
  }

  /* Create new user */
  /*
   * req.body = {
   *  username: string,
   *  email: string,
   *  password: string
   * }
   */
  try {
    const newUser = new User({ ...req.body })
    /* Default a unknown avatar */
    newUser.avatar =
      'https://t3.ftcdn.net/jpg/03/53/11/00/360_F_353110097_nbpmfn9iHlxef4EDIhXB1tdTD0lcWhG9.jpg'
    await newUser.save()
    return res.status(200).send({ message: 'User created' })
  } catch (err) {
    console.log(err)
    return res.status(500).send({ message: 'Error creating user' })
  }
})

router.get('/have-pass', async (req, res) => {
  const foundUser = await User.findOne({ email: req.query.email })
  if (!foundUser) return res.status(400).send({ err: 'User not found' })
  if (!foundUser.password) return res.status(200).send({ havePass: false })
  return res.status(200).send({ havePass: true })
})

router.get('/verify', (req, res) => {
  const token = (req.headers.authorization as string).split(' ')[1]
  jwt.verify(token, JWT_SECRET, (err, _decoded) => {
    if (err) {
      /* console.log(err) */
      if (err.name == 'TokenExpiredError') {
        console.log('Token expired')
      }
      return res.send({ verified: false })
    } else {
      return res.send({ verified: true })
    }
  })
})

router.post('/forget-password', async (req, res) => {
  /*
   * req.body = {
   * email: string
   * }
   */
  const user = await User.findOne({
    email: req.body.email,
  })
  if (!user) return res.status(200).send({ message: 'User not found' }) // status 200 because Nextjs expects 200
  if (!user.password) {
    return res
      .status(200)
      .send({ message: 'User not registered with credentials' })
  }
  let token = await Token.findOne({ userId: user._id })
  if (token) await token.deleteOne() // Delete existing token if exists

  let resetToken = crypto.randomBytes(32).toString('hex')
  await new Token({
    userId: user._id,
    email: user.email,
    token: resetToken,
    createdAt: Date.now(),
  }).save()
  const link = `http://localhost:3000/auth/reset-pass?token=${resetToken}&id=${user._id}`
  await sendMail(user.email, `Please reset your password here ${link}`)
  return res.status(200).send({ resetToken: resetToken, id: user._id })
})

router.post('/reset-password', async (req, res) => {
  /* resetPassword(id, password, token) */
  const result = await resetPassword(
    req.body.id,
    req.body.password,
    req.body.token
  )
  if (result.error) return res.status(500).send({ message: result.error })
  res.status(200).send({ message: result.message })
})

router.patch('/update-password', async (req, res) => {
  /*
   * req.body = {
   * id: string, // User id
   * oldPassword: string,
   * newPassword: string
   */
  try {
    const user = await User.findOne({ _id: req.body.id })
    if (!user) return res.status(401).send({ message: 'User not found' })

    user.comparePassword(
      req.body.oldPassword,
      async (err: any, isMatch: boolean) => {
        if (err)
          return res.status(500).send({ message: 'Error comparing password' })
        if (!isMatch)
          return res.status(401).send({ message: 'Password does not match' })
        user.password = req.body.newPassword
        await user.save()
        return res.status(200).send({ message: 'Password updated' })
      }
    )
  } catch (err) {
    console.log(err)
    res.send({ message: 'Error updating password' })
  }
})

export default router
