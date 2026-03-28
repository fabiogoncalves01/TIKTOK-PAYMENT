import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// As chaves precisam vir do .env do Vite (Ex: VITE_FIREBASE_API_KEY)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Se apiKey estiver ausente, assumimos Modo Local e não inicializamos o Firebase
let app, db, auth;
let isFirebaseConfigured = false;

if (firebaseConfig.apiKey && firebaseConfig.apiKey.length > 5 && firebaseConfig.apiKey !== 'SUA_API_KEY_AQUI') {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  isFirebaseConfigured = true;
}

export { app, db, auth, isFirebaseConfigured };
