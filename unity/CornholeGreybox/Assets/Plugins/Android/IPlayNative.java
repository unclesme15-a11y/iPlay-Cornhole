package com.iplay.cornhole;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.unity3d.player.UnityPlayer;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * iPlay Cornhole: the Android phone's own features, called from NativePlatform.cs.
 * <ul>
 *   <li>Safe storage for the login: values are encrypted with an AES key that lives in the Android Keystore (it never
 *   leaves the phone's secure hardware), and the encrypted text is kept in a private SharedPreferences file.</li>
 *   <li>Sign in with Google through Android's Credential Manager. The answer goes back through UnitySendMessage as
 *   {"ok":true,"token":"..."}, {"ok":false,"cancelled":true} or {"ok":false,"error":"..."}.</li>
 * </ul>
 * Needs androidx.credentials and Google's googleid library; Assets/Editor/IPlayAndroidBuild.cs adds them to the build.
 */
public final class IPlayNative {
    private static final String TAG = "IPlayCornhole";
    private static final String KEY_ALIAS = "iplay_cornhole_login";
    private static final String PREFS = "iplay_cornhole_secure";
    private static final int GCM_TAG_BITS = 128;

    private IPlayNative() {}

    private static Context context() {
        Activity a = UnityPlayer.currentActivity;
        return a != null ? a.getApplicationContext() : null;
    }

    // ------------------------------------------------------------------ safe storage

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return gen.generateKey();
        }
        return (SecretKey) ks.getKey(KEY_ALIAS, null);
    }

    private static SharedPreferences prefs() {
        Context c = context();
        return c == null ? null : c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean secureSet(String name, String value) {
        try {
            SharedPreferences p = prefs();
            if (p == null) return false;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[1 + iv.length + sealed.length];
            out[0] = (byte) iv.length;
            System.arraycopy(iv, 0, out, 1, iv.length);
            System.arraycopy(sealed, 0, out, 1 + iv.length, sealed.length);
            return p.edit().putString(name, Base64.encodeToString(out, Base64.NO_WRAP)).commit();
        } catch (Exception e) {
            Log.w(TAG, "secureSet failed", e);
            return false;
        }
    }

    /** The saved value, or null if there is none or it can no longer be read (for example restored from a backup of another phone). */
    public static String secureGet(String name) {
        SharedPreferences p = prefs();
        if (p == null) return null;
        String stored = p.getString(name, null);
        if (stored == null) return null;
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            int ivLen = all[0] & 0xff;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(GCM_TAG_BITS, all, 1, ivLen));
            byte[] plain = cipher.doFinal(all, 1 + ivLen, all.length - 1 - ivLen);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "secureGet could not read a saved value; forgetting it", e);
            p.edit().remove(name).commit();
            return null;
        }
    }

    public static void secureDelete(String name) {
        SharedPreferences p = prefs();
        if (p != null) p.edit().remove(name).commit();
    }

    public static void secureClear() {
        SharedPreferences p = prefs();
        if (p != null) p.edit().clear().commit();
    }

    // ------------------------------------------------------------------ Sign in with Google

    private static void send(String gameObject, String method, JSONObject payload) {
        UnityPlayer.UnitySendMessage(gameObject, method, payload.toString());
    }

    private static JSONObject result(boolean ok, String token, boolean cancelled, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", ok);
            if (token != null) o.put("token", token);
            if (cancelled) o.put("cancelled", true);
            if (error != null) o.put("error", error);
        } catch (JSONException ignored) {
            // only string/boolean values: cannot happen
        }
        return o;
    }

    /**
     * Shows Google's sign-in sheet. webClientId is the "Web application" OAuth client id (the ID token is issued for it
     * and the server checks it against GOOGLE_CLIENT_IDS). The nonce ends up inside the token as it is.
     */
    public static void signInWithGoogle(final String webClientId, final String nonce, final String gameObject, final String method) {
        final Activity activity = UnityPlayer.currentActivity;
        if (activity == null) {
            send(gameObject, method, result(false, null, false, "no activity"));
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build();
                    GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
                    CredentialManager manager = CredentialManager.create(activity);
                    Executor main = new Executor() {
                        @Override
                        public void execute(Runnable r) {
                            activity.runOnUiThread(r);
                        }
                    };
                    manager.getCredentialAsync(activity, request, new CancellationSignal(), main,
                            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                                @Override
                                public void onResult(GetCredentialResponse response) {
                                    Credential credential = response.getCredential();
                                    if (credential instanceof CustomCredential
                                            && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                        try {
                                            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                                            send(gameObject, method, result(true, google.getIdToken(), false, null));
                                        } catch (Exception e) {
                                            send(gameObject, method, result(false, null, false, "could not read Google's answer"));
                                        }
                                    } else {
                                        send(gameObject, method, result(false, null, false, "unexpected credential type"));
                                    }
                                }

                                @Override
                                public void onError(GetCredentialException e) {
                                    if (e instanceof GetCredentialCancellationException) {
                                        send(gameObject, method, result(false, null, true, null));
                                    } else {
                                        Log.w(TAG, "Google sign-in failed", e);
                                        String msg = e.getMessage();
                                        send(gameObject, method, result(false, null, false, msg != null ? msg : e.getClass().getSimpleName()));
                                    }
                                }
                            });
                } catch (Exception e) {
                    Log.w(TAG, "Google sign-in could not start", e);
                    send(gameObject, method, result(false, null, false, "could not start Google sign-in"));
                }
            }
        });
    }
}
