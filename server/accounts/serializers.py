from rest_framework import serializers


class InviteTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128, trim_whitespace=True)


class InviteAcceptSerializer(InviteTokenSerializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class InviteInfoSerializer(serializers.Serializer):
    username = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    expires_at = serializers.DateTimeField()


class InviteAcceptedSerializer(serializers.Serializer):
    username = serializers.CharField()
