import { auth, db } from "../firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import { doc ,setDoc } from "firebase/firestore";

// ✅ Login user
export const loginUser = (email, password) => {
  return signInWithEmailAndPassword(auth, email, password);
};

// ✅ Register new user
export const registerUser = async (email, password) => {
  //Create user in Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  //Save user info in Firestore
  await setDoc(doc(db, "users", user.uid), {
    email: user.email,
    createdAt: new Date(),
    role: "user"
  });

  return userCredential;
};


// ✅ Logout user
export const logoutUser = () => {
  return signOut(auth);
};

// ✅ Listen for auth state changes
export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};