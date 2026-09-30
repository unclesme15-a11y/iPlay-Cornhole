// iPlay Cornhole: the iPhone's own features, called from NativePlatform.cs.
//   - Keychain storage for the login (IPlayKeychain*)
//   - Sign in with Apple (IPlayAppleSignIn), answering through UnitySendMessage with {"ok":true,"token":"..."},
//     {"ok":false,"cancelled":true} or {"ok":false,"error":"..."}
// Needs AuthenticationServices.framework and Security.framework and the "Sign in with Apple" capability; the build
// script Assets/Editor/IPlayIosBuild.cs adds all three to the Xcode project, and compiles this file with ARC (-fobjc-arc).
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <AuthenticationServices/AuthenticationServices.h>
#import "UnityAppController.h"
#include "UnityInterface.h"

static NSString *const kIPlayKeychainService = @"com.iplay.cornhole.login";

static NSString *IPlayString(const char *s) { return s ? [NSString stringWithUTF8String:s] : @""; }

// Unity frees strings returned to C# with free(), so they must come from malloc.
static char *IPlayCopy(NSString *s)
{
    const char *u = [s UTF8String];
    if (!u) return NULL;
    char *out = (char *)malloc(strlen(u) + 1);
    strcpy(out, u);
    return out;
}

static NSMutableDictionary *IPlayKeychainQuery(NSString *key)
{
    NSMutableDictionary *q = [NSMutableDictionary dictionary];
    q[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
    q[(__bridge id)kSecAttrService] = kIPlayKeychainService;
    if (key) q[(__bridge id)kSecAttrAccount] = key;
    return q;
}

static void IPlaySend(const char *gameObject, const char *method, NSDictionary *payload)
{
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString *json = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{\"ok\":false,\"error\":\"encoding\"}";
    UnitySendMessage(gameObject, method, [json UTF8String]);
}

// ------------------------------------------------------------------ Sign in with Apple

API_AVAILABLE(ios(13.0))
@interface IPlayAppleSignInHandler : NSObject <ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding>
@property (nonatomic, copy) NSString *gameObject;
@property (nonatomic, copy) NSString *method;
@property (nonatomic, strong) ASAuthorizationController *controller;
@end

static id gIPlayAppleSignIn = nil; // keeps the delegate alive while the sheet is up

@implementation IPlayAppleSignInHandler

- (void)finish:(NSDictionary *)payload
{
    IPlaySend([self.gameObject UTF8String], [self.method UTF8String], payload);
    self.controller = nil;
    gIPlayAppleSignIn = nil;
}

- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithAuthorization:(ASAuthorization *)authorization
{
    if (![authorization.credential isKindOfClass:[ASAuthorizationAppleIDCredential class]]) {
        [self finish:@{ @"ok": @NO, @"error": @"unexpected credential" }];
        return;
    }
    ASAuthorizationAppleIDCredential *credential = (ASAuthorizationAppleIDCredential *)authorization.credential;
    NSString *token = credential.identityToken ? [[NSString alloc] initWithData:credential.identityToken encoding:NSUTF8StringEncoding] : nil;
    if (token.length == 0) {
        [self finish:@{ @"ok": @NO, @"error": @"Apple sent no identity token" }];
        return;
    }
    [self finish:@{ @"ok": @YES, @"token": token }];
}

- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithError:(NSError *)error
{
    if (error.code == ASAuthorizationErrorCanceled) {
        [self finish:@{ @"ok": @NO, @"cancelled": @YES }];
        return;
    }
    [self finish:@{ @"ok": @NO, @"error": error.localizedDescription ?: @"unknown error" }];
}

- (ASPresentationAnchor)presentationAnchorForAuthorizationController:(ASAuthorizationController *)controller
{
    return GetAppController().window;
}

@end

extern "C" {

bool IPlayKeychainSet(const char *key, const char *value)
{
    NSMutableDictionary *q = IPlayKeychainQuery(IPlayString(key));
    SecItemDelete((__bridge CFDictionaryRef)q);
    q[(__bridge id)kSecValueData] = [IPlayString(value) dataUsingEncoding:NSUTF8StringEncoding];
    // Readable after the first unlock (so a background reconnect works), never copied to another phone.
    q[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    return SecItemAdd((__bridge CFDictionaryRef)q, NULL) == errSecSuccess;
}

char *IPlayKeychainGet(const char *key)
{
    NSMutableDictionary *q = IPlayKeychainQuery(IPlayString(key));
    q[(__bridge id)kSecReturnData] = @YES;
    q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)q, &result) != errSecSuccess || result == NULL) return NULL;
    NSData *data = (__bridge_transfer NSData *)result;
    NSString *s = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return s ? IPlayCopy(s) : NULL;
}

void IPlayKeychainDelete(const char *key)
{
    SecItemDelete((__bridge CFDictionaryRef)IPlayKeychainQuery(IPlayString(key)));
}

void IPlayKeychainClear(void)
{
    SecItemDelete((__bridge CFDictionaryRef)IPlayKeychainQuery(nil));
}

bool IPlayAppleSignInAvailable(void)
{
    if (@available(iOS 13.0, *)) return true;
    return false;
}

void IPlayAppleSignIn(const char *hashedNonce, const char *gameObject, const char *method)
{
    NSString *nonce = IPlayString(hashedNonce);
    NSString *go = IPlayString(gameObject);
    NSString *m = IPlayString(method);
    if (@available(iOS 13.0, *)) {
        dispatch_async(dispatch_get_main_queue(), ^{
            ASAuthorizationAppleIDProvider *provider = [[ASAuthorizationAppleIDProvider alloc] init];
            ASAuthorizationAppleIDRequest *request = [provider createRequest];
            request.requestedScopes = @[]; // the game asks for a display name itself; no email needed
            request.nonce = nonce;

            IPlayAppleSignInHandler *handler = [[IPlayAppleSignInHandler alloc] init];
            handler.gameObject = go;
            handler.method = m;
            handler.controller = [[ASAuthorizationController alloc] initWithAuthorizationRequests:@[ request ]];
            handler.controller.delegate = handler;
            handler.controller.presentationContextProvider = handler;
            gIPlayAppleSignIn = handler;
            [handler.controller performRequests];
        });
    } else {
        IPlaySend([go UTF8String], [m UTF8String], @{ @"ok": @NO, @"error": @"Sign in with Apple needs iOS 13 or newer" });
    }
}

}
