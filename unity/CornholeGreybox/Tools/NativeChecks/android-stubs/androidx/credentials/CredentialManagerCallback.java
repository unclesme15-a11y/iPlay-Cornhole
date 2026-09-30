package androidx.credentials;
public interface CredentialManagerCallback<R, E extends Throwable> { void onResult(R result); void onError(E e); }
