import { BountyAddedTxn, BountyAwardedTxn, BountyPostedTxn } from 'common/txn'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { removeUndefinedProps } from 'common/util/object'
import { User } from 'common/user'
import { APIError } from 'common/api'
import { Contract } from 'common/contract'

export async function runPostBountyTxn(
  fbTransaction: admin.firestore.Transaction,
  txnData: Omit<BountyPostedTxn, 'id' | 'createdTime'>,
  contractRef: admin.firestore.DocumentReference,
  userRef: admin.firestore.DocumentReference
) {
  const { amount } = txnData

  const newTxnDoc = firestore.collection(`txns/`).doc()
  const txn = { id: newTxnDoc.id, createdTime: Date.now(), ...txnData }
  fbTransaction.create(newTxnDoc, removeUndefinedProps(txn))

  // update user
  fbTransaction.update(userRef, {
    balance: FieldValue.increment(-amount),
    totalDeposits: FieldValue.increment(-amount),
  })

  // update bountied contract
  fbTransaction.update(contractRef, {
    totalBounty: amount,
    bountyLeft: amount,
  })

  return { status: 'success', txn }
}

export async function runAddBountyTxn(
  fbTransaction: admin.firestore.Transaction,
  txnData: Omit<BountyAddedTxn, 'id' | 'createdTime'>
) {
  const { amount, toId, fromId } = txnData

  const contractDoc = firestore.doc(`contracts/${toId}`)
  const contractSnap = await fbTransaction.get(contractDoc)
  if (!contractSnap.exists) throw new APIError(400, 'Invalid contract')
  const contract = contractSnap.data() as Contract
  if (
    contract.mechanism !== 'none' ||
    contract.outcomeType !== 'BOUNTIED_QUESTION'
  ) {
    throw new APIError(
      400,
      'Invalid contract, only bountied questions are supported'
    )
  }

  const userDoc = firestore.doc(`users/${fromId}`)
  const userSnap = await fbTransaction.get(userDoc)
  const user = userSnap.data() as User

  if (amount > user.balance)
    throw new APIError(400, `Balance must be at least ${amount}.`)

  // update user
  fbTransaction.update(userDoc, {
    balance: FieldValue.increment(-amount),
    totalDeposits: FieldValue.increment(-amount),
  })

  // update bountied contract
  fbTransaction.update(contractDoc, {
    totalBounty: FieldValue.increment(amount),
    bountyLeft: FieldValue.increment(amount),
  })

  const newTxnDoc = firestore.collection(`txns/`).doc()
  const txn = { id: newTxnDoc.id, createdTime: Date.now(), ...txnData }
  fbTransaction.create(newTxnDoc, removeUndefinedProps(txn))

  return { status: 'success', txn }
}

export async function runAwardBountyTxn(
  fbTransaction: admin.firestore.Transaction,
  txnData: Omit<BountyAwardedTxn, 'id' | 'createdTime'>,
  authUid: string
) {
  const { amount, toId, fromId } = txnData

  const contractDoc = firestore.doc(`contracts/${fromId}`)
  const contractSnap = await fbTransaction.get(contractDoc)
  if (!contractSnap.exists) throw new APIError(400, 'Invalid contract')
  const contract = contractSnap.data() as Contract
  if (
    contract.mechanism !== 'none' ||
    contract.outcomeType !== 'BOUNTIED_QUESTION'
  ) {
    throw new APIError(
      400,
      'Invalid contract, only bountied questions are supported'
    )
  }

  if (contract.creatorId !== authUid) {
    throw new APIError(
      400,
      'A bounty can only be given by the creator of the question'
    )
  }

  const recipientDoc = firestore.doc(`users/${toId}`)

  const { bountyLeft } = contract
  if (bountyLeft < amount) {
    throw new APIError(
      400,
      `There is only M${bountyLeft} of bounty left to award, which is less than M${amount}`
    )
  }

  if (!isFinite(bountyLeft - amount)) {
    throw new APIError(
      500,
      'Invalid bounty balance left for ' + contract.question
    )
  }

  const newTxnDoc = firestore.collection(`txns/`).doc()
  const txn = { id: newTxnDoc.id, createdTime: Date.now(), ...txnData }
  fbTransaction.create(newTxnDoc, removeUndefinedProps(txn))

  // update user
  fbTransaction.update(recipientDoc, {
    balance: FieldValue.increment(amount),
    totalDeposits: FieldValue.increment(amount),
  })

  // update bountied contract
  fbTransaction.update(contractDoc, {
    bountyLeft: FieldValue.increment(-amount),
    bountyTxns: FieldValue.arrayUnion(newTxnDoc.id),
  })

  return { status: 'success', txn }
}
const firestore = admin.firestore()
