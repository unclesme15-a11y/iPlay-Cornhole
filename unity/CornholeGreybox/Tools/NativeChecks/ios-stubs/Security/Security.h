#pragma once
extern const CFStringRef kSecClass, kSecClassGenericPassword, kSecAttrService, kSecAttrAccount, kSecValueData, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, kSecReturnData, kSecMatchLimit, kSecMatchLimitOne;
extern "C" OSStatus SecItemAdd(CFDictionaryRef q, CFTypeRef *r); extern "C" OSStatus SecItemDelete(CFDictionaryRef q); extern "C" OSStatus SecItemCopyMatching(CFDictionaryRef q, CFTypeRef *r);
enum { errSecSuccess = 0 };
