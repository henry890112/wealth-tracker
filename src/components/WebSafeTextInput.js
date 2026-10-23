import React from 'react';
import { Platform, StyleSheet, TextInput } from 'react-native';

function inputModeForKeyboardType(keyboardType) {
  switch (keyboardType) {
    case 'email-address':
      return 'email';
    case 'decimal-pad':
      return 'decimal';
    case 'number-pad':
    case 'numeric':
      return 'numeric';
    case 'phone-pad':
      return 'tel';
    case 'url':
      return 'url';
    case 'search':
    case 'web-search':
      return 'search';
    default:
      return undefined;
  }
}

function normalizeWebStyle(style) {
  const flat = StyleSheet.flatten(style) || {};
  const {
    paddingHorizontal,
    paddingVertical,
    marginHorizontal,
    marginVertical,
    ...rest
  } = flat;

  return {
    ...rest,
    ...(paddingHorizontal == null ? {} : {
      paddingLeft: paddingHorizontal,
      paddingRight: paddingHorizontal,
    }),
    ...(paddingVertical == null ? {} : {
      paddingTop: paddingVertical,
      paddingBottom: paddingVertical,
    }),
    ...(marginHorizontal == null ? {} : {
      marginLeft: marginHorizontal,
      marginRight: marginHorizontal,
    }),
    ...(marginVertical == null ? {} : {
      marginTop: marginVertical,
      marginBottom: marginVertical,
    }),
    boxSizing: 'border-box',
  };
}

/**
 * react-native-web currently loses the value of controlled email/password
 * TextInputs after a render. Keep the native implementation on iOS/Android,
 * but use a real DOM input on Web so credentials remain editable.
 */
export default function WebSafeTextInput(props) {
  if (Platform.OS !== 'web') return <TextInput {...props} />;

  const {
    autoCapitalize,
    autoComplete,
    autoCorrect,
    accessibilityLabel,
    editable = true,
    inputMode,
    keyboardType,
    onChangeText,
    onKeyDown,
    onSubmitEditing,
    placeholder,
    placeholderTextColor,
    secureTextEntry,
    spellCheck,
    style,
    value,
    ...rest
  } = props;

  const resolvedInputMode = inputMode || inputModeForKeyboardType(keyboardType);
  const resolvedAutoComplete = autoComplete || (secureTextEntry ? 'current-password' : keyboardType === 'email-address' ? 'email' : undefined);

  return (
    <input
      {...rest}
      aria-label={accessibilityLabel || placeholder}
      autoCapitalize={autoCapitalize}
      autoComplete={resolvedAutoComplete}
      autoCorrect={autoCorrect === false ? 'off' : autoCorrect === true ? 'on' : undefined}
      disabled={!editable}
      inputMode={resolvedInputMode}
      onBlur={props.onBlur}
      onChange={(event) => onChangeText?.(event.currentTarget.value)}
      onFocus={props.onFocus}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === 'Enter' && onSubmitEditing) {
          event.preventDefault();
          onSubmitEditing({ nativeEvent: { text: event.currentTarget.value } });
        }
      }}
      placeholder={placeholder}
      spellCheck={spellCheck}
      style={normalizeWebStyle(style)}
      type={secureTextEntry ? 'password' : 'text'}
      defaultValue={value ?? ''}
    />
  );
}
