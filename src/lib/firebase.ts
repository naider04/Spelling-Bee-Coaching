import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  getFirestore, 
  serverTimestamp, 
  doc, 
  setDoc, 
  addDoc, 
  collection 
} from "firebase/firestore";

// ✅ NEW CONFIG (from your new Firebase project)
const firebaseConfig = {
  apiKey: "AIzaSyBWSyaanj_FP51h_EWETNX6EXSaj45q_uQ",
  authDomain: "spelling-bee-coaching-f6625.firebaseapp.com",
  projectId: "spelling-bee-coaching-f6625",
  storageBucket: "spelling-bee-coaching-f6625.firebasestorage.app",
  messagingSenderId: "149826739934",
  appId: "1:149826739934:web:1ab87057fbe95fbe08ec4f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Services
export const db = getFirestore(app);
export const auth = getAuth(app);

// --------------------
// Error handling
// --------------------
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(
  error: unknown, 
  operationType: OperationType, 
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --------------------
// Auth init (fixed)
// --------------------
export const initAuth = async () => {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsubscribe();
        resolve(user);
      }
    });
  });
};

// --------------------
// (optional) exports you might use elsewhere
// --------------------
export { serverTimestamp, doc, setDoc, addDoc, collection };