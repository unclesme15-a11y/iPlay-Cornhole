package androidx.credentials;
import android.content.Context;
import android.os.CancellationSignal;
import androidx.credentials.exceptions.GetCredentialException;
import java.util.concurrent.Executor;
public interface CredentialManager {
  static CredentialManager create(Context context) { return null; }
  void getCredentialAsync(Context context, GetCredentialRequest request, CancellationSignal cancellationSignal, Executor executor,
      CredentialManagerCallback<GetCredentialResponse, GetCredentialException> callback);
}
