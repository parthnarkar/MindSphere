import { auth, db } from "../firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

// Login user and get role
export const loginUser = async (email, password) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  // Fetch role from Firestore
  const userDoc = await getDoc(doc(db, "users", user.uid));
  const signedUp = userDoc.exists();
  const role = signedUp ? userDoc.data().role : null;
  // Determine firstLogin: true when user is signedUp but has no lastLogin recorded
  let firstLogin = false;
  try {
    if (signedUp) {
      const data = userDoc.data() || {};
      firstLogin = !data.lastLogin;
      // Update lastLogin timestamp so subsequent signins are not considered first-time
      await setDoc(doc(db, 'users', user.uid), { lastLogin: new Date() }, { merge: true });
    }
  } catch (e) {
    // If update fails, don't block sign-in; just leave firstLogin as detected
    console.warn('loginUser: failed to update lastLogin', e);
  }

  // Return signedUp flag and firstLogin so callers can decide whether to show onboarding
  return { user, role, signedUp, firstLogin };
};

// Register new user with role
export const registerUser = async (email, password, role = "user", extra = {}) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  await setDoc(doc(db, "users", user.uid), {
    email: user.email,
    createdAt: new Date(),
    role,
    ...extra
  });
  // Save counsellor details in a separate collection
  if (role === "counsellor") {
    await setDoc(doc(db, "counsellors", user.uid), {
      name: extra.name,
      specialization: extra.specialization,
      email: user.email,
      createdAt: new Date(),
    });
  }
  return userCredential;
};

// export const login = async (email, password) => {
//   const { user, role } = await loginUser(email, password);
//   if (role === "counsellor") {
//     navigate("/counsellor-dashboard");
//   } else {
//     navigate("/user-dashboard");
//   }
// };

// Logout user
export const logoutUser = () => {
  return signOut(auth);
};

// Listen for auth state changes
export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, async (currentUser) => {
    if (currentUser) {
      // Fetch role from Firestore
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const signedUp = userDoc.exists();
      const role = signedUp ? userDoc.data().role : null;
      // If counsellor, ensure counsellor profile existence flag
      let counsellorProfile = false;
      if (role === 'counsellor') {
        try {
          const cDoc = await getDoc(doc(db, 'counsellors', currentUser.uid));
          counsellorProfile = cDoc.exists();
        } catch (e) {
          counsellorProfile = false;
        }
      }
      // Add role and signedUp to user object
      const userWithRole = { ...currentUser, role, signedUp, counsellorProfile };
      callback(userWithRole);
    } else {
      callback(null);
    }
  });
};