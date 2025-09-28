import { auth, db, googleProvider } from "../firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup
} from "firebase/auth";
import { doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";

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
  // Prevent registration if an account for this email already exists with a different role
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const snaps = await getDocs(q);
    if (!snaps.empty) {
      const existing = snaps.docs[0].data();
      // If the existing account was created via Google, block role changes
      if (existing.provider === 'google' && existing.role && existing.role !== role) {
        throw new Error(`This email is already registered via Google as '${existing.role}'. Please sign in using Google or contact support to change roles.`);
      }
      // If existing role differs, block to avoid accidental cross-role registration
      if (existing.role && existing.role !== role) {
        throw new Error(`This email is already registered as '${existing.role}'. Please sign in using that role or use a different email.`);
      }
    }
  } catch (e) {
    // If the query errored, surface to caller
    if (e && e.message && e.message.startsWith('This email')) throw e;
    // otherwise continue - don't block registration on transient Firestore errors
  }

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

// Google Sign In - Only for existing users with user role
export const signInWithGoogle = async (role = "user") => {
  try {
    // Disallow Google sign-in for non-user roles
    if (role !== 'user') {
      throw new Error('Google sign-in is only available for users. Please sign in using email/password for other roles.');
    }
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // First, check if this email exists in the system with "user" role
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', user.email));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      // Email not found - create a new user doc for this Google account as role 'user'
      // This allows Google sign-in to create user accounts directly.
      const now = new Date();
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        name: user.displayName || null,
        role: 'user',
        provider: 'google',
        createdAt: now,
        lastLogin: now
      });
      return { user, role: 'user', signedUp: true, firstLogin: true };
    }
    
    // Check if the existing user has "user" role
    const existingUserDoc = querySnapshot.docs[0];
    const existingUserData = existingUserDoc.data();
    
    console.log("Google Sign-in Debug:", {
      email: user.email,
      existingRole: existingUserData.role,
      existingDocId: existingUserDoc.id,
      googleUid: user.uid
    });
    
    if (existingUserData.role !== "user") {
      // Email exists but not as user role - sign out and show error
      await signOut(auth);
      throw new Error(`This email is registered as '${existingUserData.role}'. Google sign-in is only available for users. Please use email and password to sign in.`);
    }
    
    // Email exists and is a user - create a new document with Google UID
    // but preserve the original user data and role
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      name: user.displayName || existingUserData.name,
      role: "user", // Force user role
      provider: 'google',
      createdAt: existingUserData.createdAt || new Date(),
      lastLogin: new Date(),
      originalUid: existingUserDoc.id // Keep reference to original account
    });
    
    return { user, role: "user", signedUp: true, firstLogin: false };
  } catch (error) {
    throw error;
  }
};

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
      // Add role, signedUp, and provider to user object
      const userData = userDoc.data() || {};
      const userWithRole = { 
        ...currentUser, 
        role, 
        signedUp, 
        counsellorProfile,
        provider: userData.provider || 'email'
      };
      
      console.log("Auth State Change Debug:", {
        uid: currentUser.uid,
        email: currentUser.email,
        role: role,
        provider: userData.provider || 'email',
        signedUp: signedUp
      });
      
      callback(userWithRole);
    } else {
      callback(null);
    }
  });
};