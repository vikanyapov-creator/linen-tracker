import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD9z6E_RVrrmdCnBdHC2zGAYXDya6PrqH4",
  authDomain: "linen-tracker-2f8d3.firebaseapp.com",
  projectId: "linen-tracker-2f8d3",
  storageBucket: "linen-tracker-2f8d3.firebasestorage.app",
  messagingSenderId: "778654579831",
  appId: "1:778654579831:web:bcde87d6e1494237b29a72",
  measurementId: "G-VMFN0JZENE"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };